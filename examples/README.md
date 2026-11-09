# Examples

Worked examples that exercise the library in `src/`. Run them from the repository root:

```bash
python examples/curve_basics.py        # forward rates from spot rates; live Treasury snapshot
python examples/bootstrapping.py       # par → spot bootstrapping, interpolation, pricing off the spot curve
python examples/vasicek_cir.py         # Vasicek Monte Carlo, Ito's Lemma solution, CIR vs. Vasicek
python examples/nelson_siegel_pca.py   # Nelson-Siegel fitting, PCA factors and DV01 by factor, full pipeline
```

No external dependencies; `curve_basics.py` needs an internet connection for its live Treasury example.
