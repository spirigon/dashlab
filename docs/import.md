# Import into Geometry Dash

The exporter creates **`.gdlvl`** for native import in compatible full-game builds and **`.gmd`** as a GDShare fallback. Geometry Dash itself is a separate installation. This repository does not distribute the game or its assets.

## Recorded examples

Start `npm run demo`, open http://127.0.0.1:4174, choose an example, and download its `.gdlvl` file. The same files are under `examples/recorded-repairs/`, alongside `.gmd`, geometry JSON, and complete before/after traces.

In a compatible Geometry Dash build:

1. Open the created-levels/editor area.
2. Use the file-import control and select the `.gdlvl` file.
3. Open the imported level in the editor and inspect the objects.
4. Play the level and record the mode, attempts, progress, and completion separately.

The exact button location depends on the installed version. The development playtests used Steam build ID **26002420**; a semantic game version was not independently established. If native import is unavailable, the `.gmd` file requires the separate GDShare import route rather than the native file reader.

## Export another JSON level

```bash
npm run export -- examples/recorded-repairs/M03.json --format gdlvl --out artifacts/exports/M03.gdlvl
```

Use `--format gmd` for the fallback. The command inspects the serialized structure and refuses to overwrite an existing output file. The tests include a real native-format fixture and verify the required compressed level fields. Passing export inspection confirms serialization, not completion in the game.

## Record game evidence

Normal mode completion means finishing from the beginning in one run. Practice mode allows checkpoints. Record which one was used, approximate attempts, maximum progress, game build, and whether all intended routes/coins were tested. A simulator path is not a native-game completion record. See [the evidence limits](limitations.md).
