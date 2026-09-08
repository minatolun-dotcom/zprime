import { Routes, Route, Navigate, useParams, Outlet } from "react-router-dom";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { CompanyProvider } from "./store";
import Login from "./pages/Login";
import Companies from "./pages/Companies";
import Gateway from "./pages/Gateway";
import MasterPage from "./pages/MasterPage";
import DayBook from "./pages/DayBook";
import VoucherScreen from "./pages/VoucherScreen";
import PayrollProcess from "./pages/PayrollProcess";
import ImportXml from "./pages/ImportXml";
import ChequePrint from "./pages/ChequePrint";
import Reports from "./pages/Reports";
import CompanySettings from "./pages/CompanySettings";

function CompanyLayout() {
  const { cid } = useParams();
  const id = parseInt(cid ?? "0", 10);
  if (!id) return <Navigate to="/companies" replace />;
  return (
    <CompanyProvider cid={id}>
      <Outlet />
    </CompanyProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/companies" element={<Companies />} />
      <Route element={<CompanyLayout />}>
        <Route path="/company/:cid" element={<Gateway />} />
        <Route path="/company/:cid/masters/:kind" element={<MasterPage />} />
        <Route path="/company/:cid/daybook" element={<DayBook />} />
        <Route path="/company/:cid/voucher/:typeId/new" element={<VoucherScreen />} />
        <Route path="/company/:cid/voucher/:voucherId/edit" element={<VoucherScreen />} />
        <Route path="/company/:cid/reports/:key" element={<Reports />} />
        <Route path="/company/:cid/payroll" element={<PayrollProcess />} />
        <Route path="/company/:cid/import" element={<ImportXml />} />
        <Route path="/company/:cid/cheques" element={<ChequePrint />} />
        <Route path="/company/:cid/settings" element={<CompanySettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/companies" replace />} />
    </Routes>
  );
}
