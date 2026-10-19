import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [status, setStatus] = useState<string>("loading");

  useEffect(() => {
    // Relative path — goes through the Vite dev-server proxy to the
    // backend container. Works the same from localhost or a LAN IP.
    fetch("/health")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setStatus(data.status ?? "unknown"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="app">
      <h1>Fridge Temperature Monitor</h1>
      {status === "loading" && <p>Loading…</p>}
      {status === "error" && <p>Backend status: error</p>}
      {status !== "loading" && status !== "error" && (
        <p>Backend status: {status}</p>
      )}
    </div>
  );
}

export default App;
