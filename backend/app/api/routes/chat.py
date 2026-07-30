# HumanMessage converts the incoming plain-text request into the standard
# LangChain message format expected by the LangGraph workflow.
from langchain_core.messages import HumanMessage

# APIRouter defines chat-related endpoints outside main.py.
# HTTPException converts internal generation failures into a controlled
# HTTP error response.
from fastapi import APIRouter, HTTPException

# The central settings object identifies the configured model returned
# in the API response.
from app.core.config import get_settings

# The compiled LangGraph workflow controls the AI response-generation flow.
from app.graph.chat_graph import chat_graph

# These Pydantic schemas validate the incoming request and outgoing response.
from app.schemas.chat import ChatTestRequest, ChatTestResponse


# Load the cached backend configuration.
settings = get_settings()


# Create a router dedicated to chat endpoints.
# All routes in this file automatically begin with /chat.
router = APIRouter(
    prefix="/chat",
    tags=["Chat"],
)


# POST /chat/test accepts one validated message and runs the current graph.
@router.post(
    "/test",
    response_model=ChatTestResponse,
)
async def test_chat(
    request: ChatTestRequest,
) -> ChatTestResponse:
    try:
        # Execute the compiled LangGraph asynchronously.
        # The initial graph state contains one user message.
        result = await chat_graph.ainvoke(
            {
                "messages": [
                    HumanMessage(content=request.message),
                ],
            }
        )

        # LangGraph returns the complete message state.
        # The final list item is the newly generated assistant response.
        final_message = result["messages"][-1]

        # Most text-only Ollama models return response content as a string.
        if isinstance(final_message.content, str):
            response_text = final_message.content
        else:
            # This fallback prevents failure if a future model returns
            # structured content blocks rather than a plain string.
            response_text = str(final_message.content)

        # Return a response matching the validated ChatTestResponse schema.
        return ChatTestResponse(
            model=settings.ollama_chat_model,
            response=response_text,
        )

    except Exception as exc:
        # Convert model or graph failures into a controlled service error.
        # "from exc" preserves the original exception for backend debugging.
        raise HTTPException(
            status_code=503,
            detail=f"LangGraph chat workflow failed: {str(exc)}",
        ) from exc