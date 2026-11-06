from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='../.env', extra='ignore')
    mysql_database: str = 'comgraf'
    mysql_user: str = 'comgraf'
    mysql_password: str = ''
    db_host: str = '127.0.0.1'
    db_port: int = 3306
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)
    db_pool_timeout: int = Field(default=30, ge=1, le=300)
    db_pool_recycle: int = Field(default=1800, ge=60, le=86400)
    web_thread_limit: int = Field(default=40, ge=1, le=200)
    web_limit_concurrency: int = Field(default=100, ge=1, le=10000)
    app_log_dir: str = ''
    app_timezone: str = 'America/Tegucigalpa'
    cookie_secure: bool = False
    upload_dir: str = '../uploads'
    static_dir: str = '../frontend/dist'
    product_version: str = '1.4.0'
    build_id: str = 'local-1.4.0'

    @property
    def database_url(self):
        return URL.create('mysql+pymysql', username=self.mysql_user,
                          password=self.mysql_password, host=self.db_host,
                          port=self.db_port, database=self.mysql_database,
                          query={'charset': 'utf8mb4'})


settings = Settings()
