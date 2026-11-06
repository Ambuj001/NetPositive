import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AppProvider } from "./lib/store";
import { WorldIdProvider } from "./lib/world";
import Cards from "./pages/Cards";
import Buy from "./pages/Buy";
import Home from "./pages/Home";
import Spend from "./pages/Spend";
import Track from "./pages/Track";
import Landing from "./pages/Landing";
import Market from "./pages/Market";
import Sell from "./pages/Sell";
import Trade from "./pages/Trade";

function TradeRoute() {
  const { id } = useParams();
  return <Trade key={id} />;
}

export default function App() {
  return (
    <AppProvider>
      <WorldIdProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Landing />} />
              <Route path="home" element={<Home />} />
              <Route path="spend" element={<Spend />} />
              <Route path="buy" element={<Buy />} />
              <Route path="track" element={<Track />} />
              <Route path="market" element={<Market />} />
              <Route path="sell" element={<Sell />} />
              <Route path="cards" element={<Cards />} />
              <Route path="trade/:id" element={<TradeRoute />} />
              <Route path="*" element={<Landing />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WorldIdProvider>
    </AppProvider>
  );
}
