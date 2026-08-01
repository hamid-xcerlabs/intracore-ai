# FastAPI creates the central backend application.
from fastapi import FastAPI

# Import the separate route modules that will be registered with the app.
from app.api.routes.chat import router as chat_router
from app.api.routes.health import router as health_router
from app.api.routes.models import router as models_router

#2nd update, Load application metadata from the central configuration layer.
from app.core.config import get_settings
# Import persistent conversation endpoints.
from app.api.routes.chats import router as chats_router


# CORSMiddleware permits the separately running local Next.js frontend
# to call this FastAPI backend from the browser.
from fastapi.middleware.cors import CORSMiddleware



#Created Application Object app is backend application
    #These fields appear in /docs page, properties backend api name,version and description
#0.1.0
# │ │ │
# │ │ └── small fixes
# │ └──── new features
# └────── major version  o.x indicate that project in early develpoment

# Retrieve the cached settings object.
settings = get_settings()
#app name =app : main IntraCore FastAPI application.
# main.py is now responsible primarily for application initialisation.
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Local-first backend API for IntraCore AI.",
    
)
# Allow only the configured local frontend origin.
# A wildcard is intentionally avoided so random websites cannot call the
# local IntraCore API through the user's browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



#_____________Architecture:____________

# main.py
#    ↓ registers
# API routers
#    ├── health routes
#    └── chat routes
#         ↓
# LangGraph / Providers

#_________________Registers______________
# Register health and diagnostic endpoints with the main application.
app.include_router(health_router)

# Register chat endpoints with the main application.
app.include_router(chat_router)

# Register persistent chat-management endpoints.
app.include_router(chats_router)

# Register local Ollama model discovery for the frontend selector.
app.include_router(models_router)
