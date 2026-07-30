# Annotated allows LangGraph-specific message merging behaviour
# to be attached to the messages field in ChatState.
from typing import Annotated, TypedDict

# AnyMessage allows ChatState to store HumanMessage, AIMessage,
# SystemMessage, and other LangChain message types.
# SystemMessage carries IntraCore's application-level instructions.
from langchain_core.messages import AnyMessage, SystemMessage

# START marks where the workflow begins.
# END marks where the workflow finishes.
# StateGraph creates the stateful LangGraph workflow.
from langgraph.graph import END, START, StateGraph

# add_messages appends new messages to existing graph state
# instead of replacing the complete message history.
from langgraph.graph.message import add_messages

# Import only the current minimal IntraCore system prompt.
# CAPABILITY_REMINDER was removed and must no longer be imported.
from app.prompts.system import INTRACORE_SYSTEM_PROMPT

# Import the shared Ollama provider.
# This provider contains the configured ChatOllama model client.
from app.providers.ollama_provider import ollama_provider


# ChatState defines the exact data structure that moves
# between LangGraph workflow nodes.
class ChatState(TypedDict):
    # This field stores the current conversation messages.
    # add_messages controls how newly returned messages are merged.
    messages: Annotated[list[AnyMessage], add_messages]


# This node sends the current conversation to the local model
# and returns the generated AI message.
async def generate_response(
    state: ChatState,
) -> dict[str, list[AnyMessage]]:
    # Build the ordered message list sent to the model.
    model_messages = [
        # Add the short application-level system prompt first.
        SystemMessage(content=INTRACORE_SYSTEM_PROMPT),

        # Add all current user and assistant conversation messages.
        *state["messages"],
    ]

    # Send the prepared messages through LangChain ChatOllama.
    # Ollama runs the model configured in the backend .env file.
    response = await ollama_provider.chat_client.ainvoke(
        model_messages
    )

    # Return the generated AI message to LangGraph.
    # add_messages will append it to the existing message state.
    return {
        "messages": [response],
    }


# Create a graph builder using ChatState as its shared state schema.
graph_builder = StateGraph(ChatState)

# Register generate_response as a workflow node.
graph_builder.add_node(
    "generate_response",
    generate_response,
)

# Tell LangGraph to begin at the generate_response node.
graph_builder.add_edge(
    START,
    "generate_response",
)

# Tell LangGraph to finish after response generation.
graph_builder.add_edge(
    "generate_response",
    END,
)

# Compile the graph definition into an executable workflow.
chat_graph = graph_builder.compile()