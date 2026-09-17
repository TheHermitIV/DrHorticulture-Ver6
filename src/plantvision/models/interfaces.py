from abc import ABC, abstractmethod

import numpy as np

from plantvision import ModelError


def _feature_vector(features):
    if hasattr(features, "to_vector"):
        return features.to_vector()
    return list(features)


class NDVIModel(ABC):
    @abstractmethod
    def predict(self, features) -> float:
        raise NotImplementedError

    def load(self, path):
        raise NotImplementedError

    def save(self, path):
        raise NotImplementedError


class XGBoostNDVIModel(NDVIModel):
    def __init__(self, estimator=None):
        self._estimator = estimator

    def predict(self, features) -> float:
        if self._estimator is None:
            raise ModelError("XGBoost model has not been loaded or trained.")
        vector = np.asarray(_feature_vector(features), dtype=float).reshape(1, -1)
        return float(self._estimator.predict(vector)[0])

    def load(self, path):
        try:
            import xgboost as xgb
        except ImportError as exc:
            raise ModelError(
                "xgboost is not installed. Install it with: pip install 'plantvision[ml]'"
            ) from exc
        estimator = xgb.XGBRegressor()
        estimator.load_model(str(path))
        self._estimator = estimator
        return self

    def save(self, path):
        if self._estimator is None:
            raise ModelError("XGBoost model has not been trained; nothing to save.")
        self._estimator.save_model(str(path))
        return path