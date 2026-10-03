from pathlib import Path

import yaml

from plantvision import ConfigError
from plantvision.utils.paths import default_config_dir, resolve_path


def _to_section(value):
    if isinstance(value, dict):
        return ConfigSection({key: _to_section(item) for key, item in value.items()})
    return value


class ConfigSection:
    def __init__(self, data):
        self._data = dict(data or {})

    def get(self, item, default=None):
        return _to_section(self._data.get(item, default))

    def __repr__(self):
        return f"ConfigSection({self._data!r})"


class Config:
    def __init__(self, values, config_dir):
        self.values = values
        self.config_dir = config_dir

    def section(self, name):
        section = self.values.get(name)
        if not isinstance(section, dict):
            raise ConfigError(f"Missing configuration section: '{name}'")
        return ConfigSection(section)

    def resolve(self, path_value):
        return resolve_path(path_value, base=self.config_dir)

    def __repr__(self):
        return f"Config(config_dir={self.config_dir!r})"


def _read_yaml(path):
    cfg_path = Path(path)
    if not cfg_path.is_file():
        raise ConfigError(f"Configuration file not found: {path}")
    with open(cfg_path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"Configuration file must contain a mapping: {path}")
    return data


def _deep_merge(base, override):
    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(config_dir=None, overrides=None):
    base_dir = resolve_path(config_dir or default_config_dir())
    values = _read_yaml(str(Path(base_dir) / "default.yaml"))
    for name in ("segmentation", "ndvi", "species"):
        section_file = Path(base_dir) / f"{name}.yaml"
        if section_file.is_file():
            values[name] = _deep_merge(
                values.get(name, {}), _read_yaml(str(section_file))
            )
    if overrides:
        values = _deep_merge(values, overrides)
    return Config(values, config_dir=base_dir)
