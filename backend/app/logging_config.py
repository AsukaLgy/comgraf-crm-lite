"""Small independent rotating logs for the optional LAN deployment."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from .config import settings


def configure_file_logging(component: str) -> None:
    directory = settings.app_log_dir.strip()
    if not directory:
        logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')
        return
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path / f'{component}.log', maxBytes=5 * 1024 * 1024,
                                 backupCount=4, encoding='utf-8', delay=True)
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s %(message)s'))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
