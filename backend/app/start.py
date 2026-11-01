import subprocess
import sys
import os
import logging
import uvicorn
from .config import settings
from .logging_config import configure_file_logging

logger = logging.getLogger(__name__)

def main():
    configure_file_logging('comgraf')
    logger.info('Iniciando Comgraf build=%s workers=%s', settings.build_id, os.getenv('APP_WORKERS', '2'))
    subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'], check=True)
    uvicorn.run(
        'app.main:app',
        host=os.getenv('APP_HOST', '0.0.0.0'),
        port=int(os.getenv('APP_PORT', '8000')),
        workers=int(os.getenv('APP_WORKERS', '2')),
        limit_concurrency=settings.web_limit_concurrency,
        backlog=64,
        timeout_keep_alive=5,
        access_log=os.getenv('ACCESS_LOG', 'true').lower() not in {'0', 'false', 'no'},
        log_config=None,
    )


if __name__ == '__main__':
    main()
