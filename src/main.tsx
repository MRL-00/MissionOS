import ReactDOM from "react-dom/client";
import { App } from "./app";
import "./app.css";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Missing #app root element");
}

ReactDOM.createRoot(root).render(<App />);
