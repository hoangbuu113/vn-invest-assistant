/**
 * Deterministic Test Fixtures for Vietnam Customs Trade Pack.
 *
 * Modeled strictly on authentic Vietnam Customs statistical publication layouts:
 * - Biểu số 015.T/BCB-TC (Xuất khẩu hàng hóa theo tháng)
 * - Biểu số 016.T/BCB-TC (Nhập khẩu hàng hóa theo tháng)
 */

export const OFFICIAL_CUSTOMS_URLS = Object.freeze({
  EXPORT_FEB_2026_SB: 'https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/3/4/2026-t2-2x%28vn-sb%29.pdf',
  IMPORT_FEB_2026_SB: 'https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/3/4/2026-t2-2n%28vn-sb%29.pdf',
  EXPORT_FEB_2026_REVISED: 'https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/4/10/2026-t2-2x%28vn-dc%29.pdf',
  NON_CUSTOMS_ARBITRARY: 'https://malicious-site.com/fake-trade.pdf',
  CUSTOMS_HTTP_INSECURE: 'http://files.customs.gov.vn/CustomsCMS/insecure.pdf'
});

export const VALID_EXPORT_TEXT_FEB_2026 = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Tháng 2 năm 2026
XUẤT KHẨU HÀNG HÓA THEO THÁNG
Ban CNTT & Thống kê Hải quan
Biểu số 015.T/BCB-TC
Sơ bộ
Cộng dồn đến hết 
tháng báo cáo
ĐVT
Số trong tháng báo cáo
Nhóm/Mặt hàng chủ yếu
STT
LượngTrị giá (USD)Trị giá (USD)Lượng
So với cùng kỳ 
năm trước (%)
So với tháng 
trước (%)
Trị giáLượngTrị giáLượng
TỔNG TRỊ GIÁUSD 33.090.034.032 76.392.787.810-23,418,3
Trong đó: Doanh nghiệp có vốn đầu tư trực tiếp 
nước ngoài
USD 26.493.406.127 60.229.603.333-21,230,4
 1Hàng thủy sảnUSD 706.695.436 1.717.469.932-30,120,3
 2Hàng rau quảUSD 351.158.906 995.569.387-45,545,0
 3Hạt điềuTấn 24.231 165.862.236 74.888 513.480.968-52,1-52,212,912,9
`;

export const VALID_IMPORT_TEXT_FEB_2026 = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Tháng 2 năm 2026
NHẬP KHẨU HÀNG HÓA THEO THÁNG
Ban CNTT & Thống kê Hải quan
Biểu số 016.T/BCB-TC
Sơ bộ
Cộng dồn đến hết 
tháng báo cáo
ĐVT
Số trong tháng báo cáo
Nhóm/Mặt hàng chủ yếu
STT
LượngTrị giá (USD)Trị giá (USD)Lượng
So với cùng kỳ 
năm trước (%)
So với tháng 
trước (%)
Trị giáLượngTrị giáLượng
TỔNG TRỊ GIÁUSD 34.102.372.899 79.340.410.650-24,226,3
Trong đó: Doanh nghiệp có vốn đầu tư trực tiếp 
nước ngoài
USD 24.550.402.904 56.874.646.077-23,442,2
 1Hàng thủy sảnUSD 168.659.981 466.819.487-43,4-4,7
 2Sữa và sản phẩm sữaUSD 132.704.118 265.686.282-0,217,4
 3Hàng rau quảUSD 193.374.730 565.422.456-48,039,4
`;

export const REVISED_EXPORT_TEXT_FEB_2026 = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Tháng 2 năm 2026
XUẤT KHẨU HÀNG HÓA THEO THÁNG
Ban CNTT & Thống kê Hải quan
Biểu số 015.T/BCB-TC
Điều chỉnh
Cộng dồn đến hết 
tháng báo cáo
ĐVT
Số trong tháng báo cáo
Nhóm/Mặt hàng chủ yếu
STT
LượngTrị giá (USD)Trị giá (USD)Lượng
TỔNG TRỊ GIÁUSD 33.250.000.000 76.550.000.000
`;

export const SEMIMONTHLY_EXPORT_TEXT = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Kỳ 1 tháng 2 năm 2026
XUẤT KHẨU HÀNG HÓA THEO KỲ
Ban CNTT & Thống kê Hải quan
Biểu số 015.K/BCB-TC
Sơ bộ
TỔNG TRỊ GIÁUSD 14.500.000.000 57.800.000.000
`;

export const CUMULATIVE_ONLY_EXPORT_TEXT = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Tháng 2 năm 2026
XUẤT KHẨU HÀNG HÓA
Biểu số 015.T/BCB-TC
Sơ bộ
ĐVT: USD
Cộng dồn đến hết tháng báo cáo:
Nhóm hàng chủ yếu
TỔNG TRỊ GIÁ KHÔNG CÓ CỘT THÁNG
`;

export const PERCENT_CHANGE_ONLY_TEXT = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Tháng 2 năm 2026
NHẬP KHẨU HÀNG HÓA THEO THÁNG
Biểu số 016.T/BCB-TC
Sơ bộ
ĐVT: USD
TỔNG TRỊ GIÁ USD 18,3
`;

export const PARTNER_SUBTOTAL_ONLY_TEXT = `
CỤC HẢI QUAN
BỘ TÀI CHÍNH
Tháng 2 năm 2026
XUẤT KHẨU HÀNG HÓA THEO THỊ TRƯỜNG
Biểu số 018.T/BCB-TC
Sơ bộ
ĐVT: USD
1. Hoa Kỳ: 8.500.000.000 USD
2. Trung Quốc: 5.200.000.000 USD
3. EU: 4.100.000.000 USD
`;

export const VALID_PDF_MOCK_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Title (Vietnam Customs Report) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'
);

export const INVALID_NON_PDF_BUFFER = Buffer.from(
  '<!DOCTYPE html><html><head><title>Error</title></head><body>Not a PDF</body></html>'
);
