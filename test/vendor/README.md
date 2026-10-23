# Vendored React for the offline smoke harness

`test/harness.html` loads these UMD builds so `node scripts/smoke.mjs` works
without installing npm dependencies or reaching the network.

| File | Package | Version | SHA-256 |
| --- | --- | --- | --- |
| `react.production.min.js` | react | 18.3.1 | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` |
| `react-dom.production.min.js` | react-dom | 18.3.1 | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` |

Source: `https://unpkg.com/react@18.3.1/umd/react.production.min.js` and
`https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js`.

Both files carry Facebook's MIT license header. React is MIT licensed; see
<https://github.com/facebook/react/blob/main/LICENSE>. They are used only by
the test harness, not by the plugin at runtime.
