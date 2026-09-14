import { Router } from "express";
import { getPositions, getHoldings, getPnlSummary } from "../services/portfolioService";
import { getFunds, getTransactions, resetAccount } from "../services/fundsService";

export const portfolioRouter = Router();

portfolioRouter.get("/positions", (_req, res) => {
  res.json(getPositions());
});

portfolioRouter.get("/holdings", (_req, res) => {
  res.json(getHoldings());
});

portfolioRouter.get("/funds", (_req, res) => {
  res.json(getFunds());
});

portfolioRouter.get("/transactions", (_req, res) => {
  res.json(getTransactions());
});

portfolioRouter.get("/pnl-summary", (_req, res) => {
  res.json(getPnlSummary());
});

portfolioRouter.post("/reset", (_req, res) => {
  resetAccount();
  res.json({ ok: true });
});
