"""A synthetic local node. Run `python fl_client.py India` and likewise for Brazil."""
import sys
import flwr as fl
import numpy as np

COUNTRY = sys.argv[1] if len(sys.argv) > 1 else "India"
SEED = {"India": 11, "Brazil": 37, "SouthAfrica": 63}.get(COUNTRY, 11)
rng = np.random.default_rng(SEED)
# Local-only synthetic data: daily demand responds to population index and a seasonal feature.
n = 600
X = np.column_stack([rng.uniform(0.2, 1.5, n), np.sin(np.arange(n) * 2 * np.pi / 30)])
true = np.array([18.0 + (SEED % 7), 3.4, 12.0])
y = np.maximum(0, X @ true[:2] + true[2] + rng.normal(0, 2.0, n))
X = np.column_stack([X, np.ones(n)])

class DemandClient(fl.client.NumPyClient):
    def __init__(self): self.weights = np.zeros(3, dtype=np.float32)
    def get_parameters(self, config): return [self.weights]
    def fit(self, parameters, config):
        self.weights = parameters[0].astype(np.float32)
        # Local batch gradient descent: no features or records leave this process.
        for _ in range(80):
            error = X @ self.weights - y
            self.weights -= (0.04 / n) * (X.T @ error).astype(np.float32)
        print(f"{COUNTRY}: trained on {n} local samples; sharing 3 model coefficients")
        return [self.weights], n, {"country": COUNTRY}
    def evaluate(self, parameters, config):
        weights = parameters[0]
        mse = float(np.mean((X @ weights - y) ** 2))
        return mse, n, {"mae": float(np.mean(np.abs(X @ weights - y)))}

if __name__ == "__main__":
    print(f"Connecting {COUNTRY} node to Flower server at 127.0.0.1:8080")
    fl.client.start_numpy_client(server_address="127.0.0.1:8080", client=DemandClient())
