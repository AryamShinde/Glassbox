import os

from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
GROQ_MODEL = "openai/gpt-oss-20b"
MAX_ITERATIONS = 8

RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "5"))
RATE_LIMIT_WINDOW_SEC = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "3600"))
BYO_KEY_HEADER = "x-groq-key"
