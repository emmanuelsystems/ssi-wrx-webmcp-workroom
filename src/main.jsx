import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import OperatingDashboard from './OperatingDashboard.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <OperatingDashboard />
  </StrictMode>,
)
