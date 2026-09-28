"""Data Foundry Local Collector.

A small, resumable collector that runs on the operator's own computer: it reads
permitted source evidence, asks a local Ollama model to *propose* structured
facts, checks every proposal deterministically, and submits the survivors to
Data Foundry's authenticated intake, where the server decides again.

Standard library only, so it installs with nothing but Python 3.11+.
"""

__version__ = "0.1.0"
COLLECTOR_ID = f"df-local-collector@{__version__}"
