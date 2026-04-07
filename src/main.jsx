import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ClientPage from './pages/ClientPage';
import MonitorPage from './pages/MonitorPage';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ClientPage />} />
        <Route path="/monitor" element={<MonitorPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
