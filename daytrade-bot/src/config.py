from datetime import datetime, time
from pathlib import Path

import yaml


def load_config(path: str = "config.yaml") -> dict:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(
            f"Arquivo de configuração '{path}' não encontrado. "
            f"Copie config.example.yaml para config.yaml e ajuste os valores."
        )
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def parse_time(value: str) -> time:
    return datetime.strptime(value, "%H:%M").time()


def parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")
