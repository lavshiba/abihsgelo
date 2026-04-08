import "./styles.css";
import { AppController } from "./app";

new AppController(document.querySelector("#app") as HTMLDivElement).start().catch((error) => {
  console.error(error);
});
