# LangChain message classes reconstruct durable conversation history.
from langchain_core.messages import AIMessage, HumanMessage

# AsyncSession carries the request-scoped database unit of work.
from sqlalchemy.ext.asyncio import AsyncSession

# Central settings identify the model used for assistant persistence metadata.
from app.core.config import get_settings

# Chat and Message are the durable ORM entities coordinated by this service.
from app.db.models.chat import Chat
from app.db.models.message import Message

# The existing compiled graph remains responsible for AI generation.
from app.graph.chat_graph import chat_graph

# MessageRepository owns all durable message reads and writes.
from app.repositories.message_repository import message_repository


# ConversationGenerationError hides graph and provider implementation details.
class ConversationGenerationError(Exception):
    pass


# ConversationService coordinates one complete durable conversation turn.
class ConversationService:
    # Save a user message, generate a response, and save the assistant message.
    async def create_durable_turn(
        self,
        session: AsyncSession,
        chat: Chat,
        content: str,
    ) -> tuple[Message, Message]:
        # Commit the user message first so it survives generation failures.
        user_message = await message_repository.create_user_message(
            session=session,
            chat=chat,
            content=content,
        )

        # Load the authoritative complete history after the user commit.
        durable_history = await message_repository.list_for_chat(
            session=session,
            chat_id=chat.id,
        )

        # Convert supported durable roles into LangChain message objects.
        graph_messages = []

        for message in durable_history:
            if message.role == "user":
                graph_messages.append(
                    HumanMessage(content=message.content)
                )
            elif message.role == "assistant":
                graph_messages.append(
                    AIMessage(content=message.content)
                )

        # End the read transaction before the potentially slow Ollama call.
        await session.commit()

        try:
            result = await chat_graph.ainvoke(
                {
                    "messages": graph_messages,
                }
            )

            final_message = result["messages"][-1]

            if isinstance(final_message.content, str):
                assistant_content = final_message.content
            else:
                assistant_content = str(final_message.content)
        except Exception as exc:
            # The user message is already committed; no assistant exists yet.
            await session.rollback()
            raise ConversationGenerationError from exc

        # Persist exactly one assistant message after successful generation.
        assistant_message = (
            await message_repository.create_assistant_message(
                session=session,
                chat_id=chat.id,
                content=assistant_content,
                model_name=get_settings().ollama_chat_model,
            )
        )

        return user_message, assistant_message


# Export one stateless service instance for route reuse.
conversation_service = ConversationService()
