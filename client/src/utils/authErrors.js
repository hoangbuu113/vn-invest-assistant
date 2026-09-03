/**
 * Sanitizes and maps Supabase Auth error responses to safe, localized Vietnamese error strings.
 * Never exposes internal error stacks, table names, or provider URLs.
 * @param {Error|{ message?: string, status?: number, statusCode?: number }} error
 * @returns {string}
 */
export function mapAuthErrorToVietnamese(error) {
  if (!error) return '';
  const message = error.message || '';
  const status = error.status || error.statusCode;

  if (status === 429 || message.toLowerCase().includes('rate')) {
    return 'Tần suất đăng nhập quá giới hạn. Vui lòng thử lại sau ít phút.';
  }
  if (message.includes('Invalid login credentials')) {
    return 'Email hoặc mật khẩu không đúng.';
  }
  if (message.toLowerCase().includes('email not confirmed')) {
    return 'Tài khoản chưa được xác nhận email. Vui lòng kiểm tra hộp thư.';
  }
  if (message.toLowerCase().includes('failed to fetch') || message.toLowerCase().includes('network')) {
    return 'Không thể kết nối máy chủ. Vui lòng kiểm tra đường truyền và thử lại.';
  }
  if (message.toLowerCase().includes('signup') && message.toLowerCase().includes('disabled')) {
    return 'Hiện chưa mở đăng ký tài khoản mới.';
  }
  if (message.toLowerCase().includes('user already registered')) {
    return 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc sử dụng email khác.';
  }
  return 'Đã xảy ra lỗi khi xác thực. Vui lòng thử lại.';
}
