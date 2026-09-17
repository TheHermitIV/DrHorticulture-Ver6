from plantvision import ModelError


class NDVIProxy:
    def __init__(self, method="exg"):
        self.method = method

    def predict(self, features) -> float:
        data = features.to_dict() if hasattr(features, "to_dict") else dict(features)
        if self.method == "exg":
            if "exg" not in data:
                raise ModelError("Proxy method 'exg' requires the 'exg' feature.")
            return float(data["exg"])
        if self.method == "green_ratio":
            if "green_ratio" not in data:
                raise ModelError("Proxy method 'green_ratio' requires the 'green_ratio' feature.")
            return float(data["green_ratio"])
        raise ModelError(f"Unknown NDVI proxy method: '{self.method}'.")