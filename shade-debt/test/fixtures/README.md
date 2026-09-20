# Test fixtures

Real GIBS ColorMap documents, copied unmodified from NASA's own
[`nasa-gibs/onearth`](https://github.com/nasa-gibs/onearth) repository
(Apache-2.0; the documents themselves are NASA-produced).

They exist so the palette parser is tested against the format NASA actually
publishes rather than against a fixture written to match the parser — the
failure mode that hides a real incompatibility.

| File | Why it is here |
|---|---|
| `ColorMap_v1.2_Sample.xml` | Four `ColorMap` blocks in one document, so the "pick the richest palette" rule is exercised against a genuine multi-block file. |
| `GHRSST_Sea_Surface_Temperature_Anomalies.xml` | A real continuous palette carrying `units="°C"` and a separate no-data block, covering unit handling and the cloud/fill mask. |
