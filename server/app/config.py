from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings from the repo's .env (see .env.example). Nothing here is required to start."""

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    server_host: str = "127.0.0.1"
    server_port: int = 8765
    whisper_model: str = "mlx-community/whisper-large-v3-turbo"
    anilist_graphql_url: str = "https://graphql.anilist.co"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    # Correction is a bonus: past this, the line is shown as Whisper heard it.
    llm_timeout_s: float = 4.0


settings = Settings()
