import "dotenv/config";
import express from "express";
import cors from "cors";
import { sitesRouter } from "./routes/sites.js";
import { productsRouter } from "./routes/products.js";
import { scrapeRouter } from "./routes/scrape.js";
import { categoriesRouter } from "./routes/categories.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

// CORS configuration - allow production and local dev
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://diez-music-compare.giving",
  "http://localhost:5173",
].filter(Boolean) as string[];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, origin || allowedOrigins[0]);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  })
);
app.use(express.json());

// Public auth routes (no authentication required)
app.use("/api/auth", authRouter);

// Protected routes (require authentication)
app.use("/api/sites", requireAuth, sitesRouter);
app.use("/api/products", requireAuth, productsRouter);
app.use("/api/scrape", requireAuth, scrapeRouter);
app.use("/api/categories", requireAuth, categoriesRouter);

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
