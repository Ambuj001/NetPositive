import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import DisputeTest from './DisputeTest.jsx';

// /            → sign-up + wallet recovery test
// /?page=dispute → dispute → human ban test
const page = new URLSearchParams(location.search).get('page');
createRoot(document.getElementById('root')).render(page === 'dispute' ? <DisputeTest /> : <App />);
