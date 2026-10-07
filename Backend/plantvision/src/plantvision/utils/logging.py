import logging
import sys


def configure_logging(level="INFO"):
    root = logging.getLogger("plantvision")
    root.setLevel(str(level).upper())
    if not root.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        root.addHandler(handler)
    root.propagate = False
    return root


def get_logger(name):
    return logging.getLogger(f"plantvision.{name}")