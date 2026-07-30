from pydantic import BaseModel, Field


class ChatTestRequest(BaseModel): #Yeh incoming request ka structure define karta hai.
    #reject empty message
    message: str = Field( 
        min_length=1, #Yeh empty message reject karta hai.
        description="The message to send to the local chat model.",
    )


class ChatTestResponse(BaseModel): #Backend guarantee karta hai ke successful response hamesha is shape mein hoga:
    model: str
    response: str