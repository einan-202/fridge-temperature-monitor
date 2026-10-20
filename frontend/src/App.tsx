import { useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { WeeklyUpload } from "./components/WeeklyUpload";
import "./App.css";

type Page = "dashboard" | "weekly-upload";

function App() {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="app">
      <nav className="app-nav" aria-label="Main">
        <button
          type="button"
          className={
            page === "dashboard" ? "app-nav__btn app-nav__btn--active" : "app-nav__btn"
          }
          aria-current={page === "dashboard" ? "page" : undefined}
          onClick={() => setPage("dashboard")}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={
            page === "weekly-upload"
              ? "app-nav__btn app-nav__btn--active"
              : "app-nav__btn"
          }
          aria-current={page === "weekly-upload" ? "page" : undefined}
          onClick={() => setPage("weekly-upload")}
        >
          Weekly Upload
        </button>
      </nav>
      {page === "dashboard" ? <Dashboard /> : <WeeklyUpload />}
    </div>
  );
}

export default App;
