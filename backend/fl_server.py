"""Flower FedAvg server. Start this first: python fl_server.py"""
import flwr as fl
from flwr.common import ndarrays_to_parameters
import numpy as np

initial = [np.zeros(3, dtype=np.float32)]  # two coefficients + bias
strategy = fl.server.strategy.FedAvg(
    fraction_fit=1.0, fraction_evaluate=1.0,
    min_fit_clients=2, min_evaluate_clients=2, min_available_clients=2,
    initial_parameters=ndarrays_to_parameters(initial),
)
if __name__ == "__main__":
    print("Starting ArogyaFederate Flower server at 0.0.0.0:8080; connect both clients now.")
    fl.server.start_server(server_address="0.0.0.0:8080",
                           config=fl.server.ServerConfig(num_rounds=5), strategy=strategy)
