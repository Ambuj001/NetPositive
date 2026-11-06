import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AppProvider } from "./lib/store";
import Cards from "./pages/Cards";
import Buy from "./pages/Buy";
import Home from "./pages/Home";
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
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Landing />} />
            <Route path="home" element={<Home key="home" />} />
            <Route path="spend" element={<Home key="spend" spend />} />
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
    </AppProvider>
  );
}
