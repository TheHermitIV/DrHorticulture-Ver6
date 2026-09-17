from plantvision import ModelError
from plantvision.models.interfaces import XGBoostNDVIModel

_REGISTRY = {"xgboost": XGBoostNDVIModel}


def available_models():
    return sorted(_REGISTRY)


def create(name):
    factory = _REGISTRY.get(name)
    if factory is None:
        raise ModelError(
            f"Unknown NDVI model '{name}'. Available models: {', '.join(available_models())}"
        )
    return factory()


def load_model(name, path):
    return create(name).load(path)