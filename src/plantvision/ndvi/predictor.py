from dataclasses import dataclass
from pathlib import Path

from plantvision import ModelError
from plantvision.models.registry import load_model
from plantvision.ndvi.proxy import NDVIProxy


@dataclass
class NDVIPrediction:
    value: float
    type: str
    method: str = ""
    model_name: str = ""


class NDVIPredictor:
    def __init__(self, proxy, model=None, model_name=""):
        self.proxy = proxy
        self.model = model
        self.model_name = model_name

    @classmethod
    def from_config(cls, config):
        ndvi = config.section("ndvi")
        proxy_config = ndvi.get("proxy", {})
        proxy = NDVIProxy(method=proxy_config.get("method", "exg"))
        mode = str(ndvi.get("mode", "auto")).lower()
        model_name = str(ndvi.get("model", "xgboost"))
        model_path_value = ndvi.get("model_path") or ""
        model_path = config.resolve(model_path_value) if model_path_value else ""

        if mode == "model":
            if not model_path or not Path(model_path).is_file():
                raise ModelError(
                    f"NDVI model weights not found at '{model_path_value or model_path}'. "
                    "Train a model or set ndvi.mode to 'proxy'."
                )
            return cls(proxy, model=load_model(model_name, model_path), model_name=model_name)

        if mode == "proxy":
            return cls(proxy)

        if model_path and Path(model_path).is_file():
            return cls(proxy, model=load_model(model_name, model_path), model_name=model_name)
        return cls(proxy)

    def predict(self, features) -> NDVIPrediction:
        if self.model is not None:
            return NDVIPrediction(
                value=self.model.predict(features),
                type="model",
                model_name=self.model_name,
            )
        return NDVIPrediction(
            value=self.proxy.predict(features),
            type="rgb_proxy",
            method=str(self.proxy.method),
        )