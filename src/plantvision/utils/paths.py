import os
from pathlib import Path


def project_root():
    return Path(__file__).resolve().parents[3]


def default_config_dir():
    env = os.environ.get("PLANTVISION_CONFIG_DIR")
    if env:
        return resolve_path(env)
    return str(project_root() / "configs")


def default_output_dir():
    env = os.environ.get("PLANTVISION_OUTPUT_DIR")
    if env:
        return env
    return str(project_root() / "outputs")


def resolve_path(path_value, base=None):
    raw = os.path.expandvars(os.path.expanduser(str(path_value)))
    path = Path(raw)
    if path.is_absolute():
        return str(path)
    candidates = [project_root() / path]
    if base:
        candidates.append(Path(base) / path)
    candidates.append(path)
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return str(candidates[0])


def ensure_dir(path):
    directory = Path(path)
    directory.mkdir(parents=True, exist_ok=True)
    return str(directory)