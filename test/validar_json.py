import json, sys, pathlib
from jsonschema import Draft4Validator

schema = json.load(open(sys.argv[1], encoding="utf-8"))
validator = Draft4Validator(schema)
fallos = 0
for archivo in sorted(pathlib.Path(sys.argv[2]).glob("*.json")):
    errores = sorted(validator.iter_errors(json.load(open(archivo, encoding="utf-8"))), key=lambda e: list(e.path))
    if errores:
        fallos += 1
        print("FALLA " + archivo.stem)
        for e in errores[:3]:
            print("   /" + "/".join(map(str, e.path)) + ": " + e.message[:150])
    else:
        print("OK    " + archivo.stem)
print("\n" + (str(fallos) + " caso(s) con errores" if fallos else "Todos los JSON son válidos según el esquema."))
sys.exit(1 if fallos else 0)
