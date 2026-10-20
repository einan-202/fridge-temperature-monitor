import { useState } from "react";
import { Dashboard, type OpenFridgeRequest } from "./components/Dashboard";
import { FridgeDetails } from "./components/FridgeDetails";
import { WeeklyUpload } from "./components/WeeklyUpload";
import "./App.css";

type Page = "dashboard" | "weekly-upload";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [detail, setDetail] = useState<OpenFridgeRequest | null>(null);

  const openDashboard = () => {
    setDetail(null);
    setPage("dashboard");
  };

  const showMainNav = page === "weekly-upload" || !detail;

  return (
    <div className={detail ? "app app--details" : "app"}>
      {showMainNav ? (
        <nav className="app-nav" aria-label="Main">
          <button
            type="button"
            className={
              page === "dashboard" ? "app-nav__btn app-nav__btn--active" : "app-nav__btn"
            }
            aria-current={page === "dashboard" ? "page" : undefined}
            onClick={openDashboard}
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
            onClick={() => {
              setDetail(null);
              setPage("weekly-upload");
            }}
          >
            Weekly Upload
          </button>
        </nav>
      ) : null}
      {page === "weekly-upload" ? (
        <WeeklyUpload />
      ) : (
        <>
          <div
            className={detail ? "app-panel app-panel--hidden" : "app-panel"}
            hidden={Boolean(detail)}
          >
            <Dashboard onOpenFridge={setDetail} />
          </div>
          {detail ? (
            <FridgeDetails
              fridge={detail.fridge}
              week={detail.week}
              weekStart={detail.weekStart}
              weekEnd={detail.weekEnd}
              onBack={() => setDetail(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export default App;
