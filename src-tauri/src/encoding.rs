use serde::{Deserialize, Serialize};


/// 文档编码类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EncodingKind {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Gbk,
    Big5,
    Latin1,
}

impl EncodingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EncodingKind::Utf8 => "utf-8",
            EncodingKind::Utf8Bom => "utf-8-bom",
            EncodingKind::Utf16Le => "utf-16le",
            EncodingKind::Utf16Be => "utf-16be",
            EncodingKind::Gbk => "gbk",
            EncodingKind::Big5 => "big5",
            EncodingKind::Latin1 => "latin1",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().replace('_', "-").as_str() {
            "utf-8" | "utf8" => Some(EncodingKind::Utf8),
            "utf-8-bom" | "utf8bom" => Some(EncodingKind::Utf8Bom),
            "utf-16le" | "utf16le" => Some(EncodingKind::Utf16Le),
            "utf-16be" | "utf16be" => Some(EncodingKind::Utf16Be),
            "gbk" | "gb2312" | "gb18030" => Some(EncodingKind::Gbk),
            "big5" => Some(EncodingKind::Big5),
            "latin1" | "iso-8859-1" => Some(EncodingKind::Latin1),
            _ => None,
        }
    }

    fn encoding_rs(self) -> Option<&'static encoding_rs::Encoding> {
        match self {
            EncodingKind::Utf8 | EncodingKind::Utf8Bom => Some(encoding_rs::UTF_8),
            EncodingKind::Utf16Le => Some(encoding_rs::UTF_16LE),
            EncodingKind::Utf16Be => Some(encoding_rs::UTF_16BE),
            EncodingKind::Gbk => Some(encoding_rs::GBK),
            EncodingKind::Big5 => Some(encoding_rs::BIG5),
            EncodingKind::Latin1 => Some(encoding_rs::WINDOWS_1252),
        }
    }
}

/// 换行符风格
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
}

#[allow(dead_code)]
impl Eol {
    pub fn as_str(self) -> &'static str {
        match self {
            Eol::Lf => "\n",
            Eol::Crlf => "\r\n",
            Eol::Cr => "\r",
        }
    }
}

/// 解码结果：文本 + 探测到的编码 + 换行符
#[derive(Debug, Serialize)]
pub struct Decoded {
    pub text: String,
    pub encoding: EncodingKind,
    pub eol: String,
    pub bom: bool,
    pub mixed_eol: bool,
    /// 是否为二进制文件（含 \0 且不像 UTF-16）
    pub binary: bool,
}

const BINARY_SNIFF_LIMIT: usize = 8192;

pub fn decode_bytes(bytes: &[u8], forced: Option<EncodingKind>) -> Decoded {
    // 1. 明确指定编码 -> 直接按指定解码
    if let Some(enc) = forced {
        return decode_with(bytes, enc);
    }

    // 2. BOM 探测
    if bytes.len() >= 3 && &bytes[0..3] == b"\xEF\xBB\xBF" {
        let mut d = decode_with(&bytes[3..], EncodingKind::Utf8);
        d.encoding = EncodingKind::Utf8Bom;
        d.bom = true;
        return d;
    }
    if bytes.len() >= 2 && &bytes[0..2] == b"\xFF\xFE" {
        let mut d = decode_with(&bytes[2..], EncodingKind::Utf16Le);
        d.encoding = EncodingKind::Utf16Le;
        d.bom = true;
        return d;
    }
    if bytes.len() >= 2 && &bytes[0..2] == b"\xFE\xFF" {
        let mut d = decode_with(&bytes[2..], EncodingKind::Utf16Be);
        d.encoding = EncodingKind::Utf16Be;
        d.bom = true;
        return d;
    }

    // 3. UTF-8 严格校验（取前 64KB 判断）
    let sniff_len = bytes.len().min(64 * 1024);
    let head = &bytes[..sniff_len];
    // 保证不切断多字节序列
    let head_trimmed = trim_to_char_boundary(head, bytes.len() <= sniff_len);
    if std::str::from_utf8(head_trimmed).is_ok() {
        let d = decode_with(bytes, EncodingKind::Utf8);
        // 判断二进制
        return d;
    }

    // 4. 二进制嗅探（无 BOM 的 UTF-16 也在这里处理）
    let zero_ratio = count_zeros(head) as f64 / head.len().max(1) as f64;
    if zero_ratio > 0.30 {
        // 可能是 UTF-16 无 BOM
        if let Some(enc) = sniff_utf16(head) {
            return decode_with(bytes, enc);
        }
        return Decoded {
            text: String::new(),
            encoding: EncodingKind::Utf8,
            eol: "\n".to_string(),
            bom: false,
            mixed_eol: false,
            binary: true,
        };
    }

    // 5. GBK 优先（中文环境），失败退 Big5，再退 Latin1
    for enc in [EncodingKind::Gbk, EncodingKind::Big5] {
        if decode_ok(bytes, enc) {
            return decode_with(bytes, enc);
        }
    }
    decode_with(bytes, EncodingKind::Latin1)
}

fn trim_to_char_boundary<'a>(head: &'a [u8], whole: bool) -> &'a [u8] {
    if whole {
        return head;
    }
    let mut n = head.len();
    // UTF-8 多字节序列最多 4 字节，最多回退 3 字节
    for _ in 0..4 {
        if n == 0 {
            break;
        }
        if std::str::from_utf8(&head[..n]).is_ok() {
            return &head[..n];
        }
        n -= 1;
    }
    head
}

fn count_zeros(b: &[u8]) -> usize {
    b.iter().take(BINARY_SNIFF_LIMIT).filter(|&&x| x == 0).count()
}

fn sniff_utf16(b: &[u8]) -> Option<EncodingKind> {
    // 偶数位多为 0 -> UTF-16LE（ASCII 文本特征）
    let even_zeros = b.iter().step_by(2).filter(|&&x| x == 0).count();
    let odd_zeros = b.iter().skip(1).step_by(2).filter(|&&x| x == 0).count();
    if odd_zeros > even_zeros * 3 && odd_zeros > 0 {
        Some(EncodingKind::Utf16Le)
    } else if even_zeros > odd_zeros * 3 && even_zeros > 0 {
        Some(EncodingKind::Utf16Be)
    } else {
        None
    }
}

fn decode_ok(bytes: &[u8], enc: EncodingKind) -> bool {
    match enc.encoding_rs() {
        Some(e) => {
            let (_, _, had_errors) = e.decode(bytes);
            !had_errors
        }
        None => false,
    }
}

fn decode_with(bytes: &[u8], enc: EncodingKind) -> Decoded {
    let text: std::borrow::Cow<'_, str> = match enc.encoding_rs() {
        Some(e) => {
            let (cow, _, _) = e.decode(bytes);
            cow
        }
        None => std::borrow::Cow::Borrowed(""),
    };
    let text = text.into_owned();
    let (eol, mixed) = detect_eol(&text);
    Decoded {
        text,
        encoding: enc,
        eol,
        bom: false,
        mixed_eol: mixed,
        binary: false,
    }
}

fn detect_eol(text: &str) -> (String, bool) {
    let crlf = text.matches("\r\n").count();
    let lf_only = text.matches('\n').count() - crlf;
    let cr_only = text.matches('\r').count() - crlf;
    let kinds = [crlf, lf_only, cr_only].iter().filter(|&&c| c > 0).count();
    let eol = if crlf > 0 && crlf >= lf_only && crlf >= cr_only {
        "\r\n"
    } else if cr_only > 0 && cr_only >= lf_only {
        "\r"
    } else {
        "\n"
    };
    (eol.to_string(), kinds > 1)
}

/// 编码文本用于写盘
pub fn encode_text(text: &str, enc: EncodingKind) -> Vec<u8> {
    match enc {
        EncodingKind::Utf8 => text.as_bytes().to_vec(),
        EncodingKind::Utf8Bom => {
            let mut v = Vec::with_capacity(text.len() + 3);
            v.extend_from_slice(b"\xEF\xBB\xBF");
            v.extend_from_slice(text.as_bytes());
            v
        }
        EncodingKind::Latin1 => match encoding_rs::WINDOWS_1252.encode(text) {
            (cow, _, _) => cow.into_owned(),
        },
        _ => match enc.encoding_rs() {
            Some(e) => {
                let (cow, _, _) = e.encode(text);
                cow.into_owned()
            }
            None => text.as_bytes().to_vec(),
        },
    }
}

/// 快速二进制判定：取前 8KB，若出现 NUL 且 BOM 不是 UTF-16/32，视为二进制。
/// 注意 UTF-16 文本里也有大量 NUL，所以先看 BOM。
pub fn is_probably_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    if bytes.len() >= 2 {
        let b = &bytes[0..2];
        if b == b"\xFF\xFE" || b == b"\xFE\xFF" {
            return false;
        }
    }
    if bytes.len() >= 3 && &bytes[0..3] == b"\xEF\xBB\xBF" {
        return false;
    }
    let sniff = &bytes[..bytes.len().min(BINARY_SNIFF_LIMIT)];
    let zeros = sniff.iter().filter(|&&b| b == 0).count();
    // 无 BOM 的 UTF-16 ASCII 文本 NUL 占比接近 50%，先按 UTF-16 嗅探排除
    if zeros * 100 / sniff.len().max(1) > 30 {
        if sniff_utf16(sniff).is_some() {
            return false;
        }
        return true;
    }
    false
}


