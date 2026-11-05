/**
 * Minimal JSON scanner for the gadget socket protocol.
 * Not a general-purpose parser: it only locates top-level object keys, returns raw
 * value text (payloads stay opaque JSON), and (un)escapes string literals.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_MINI_JSON_H
#define XPANDA_GADGET_MINI_JSON_H

#include <cstdint>
#include <string>

namespace xpanda {

class MiniJson {
public:
    static size_t skipWs(const std::string& s, size_t pos) {
        while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\r' || s[pos] == '\n')) pos++;
        return pos;
    }

    /** End index (exclusive) of the JSON value starting at pos. */
    static size_t endOfValue(const std::string& s, size_t pos) {
        if (pos >= s.size()) return pos;
        char c = s[pos];
        if (c == '"') return endOfString(s, pos);
        if (c == '{' || c == '[') {
            int depth = 0;
            while (pos < s.size()) {
                char ch = s[pos];
                if (ch == '"') {
                    pos = endOfString(s, pos);
                    continue;
                }
                if (ch == '{' || ch == '[') depth++;
                else if (ch == '}' || ch == ']') {
                    depth--;
                    if (depth == 0) return pos + 1;
                }
                pos++;
            }
            return pos;
        }
        // number / true / false / null: run until a structural character
        while (pos < s.size()) {
            char ch = s[pos];
            if (ch == ',' || ch == '}' || ch == ']' || ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') break;
            pos++;
        }
        return pos;
    }

    /** Raw JSON text of a top-level `key` in the object `json`; "" when absent or malformed. */
    static std::string findRawValue(const std::string& json, const std::string& key) {
        size_t pos = skipWs(json, 0);
        if (pos >= json.size() || json[pos] != '{') return "";
        pos++;
        while (true) {
            pos = skipWs(json, pos);
            if (pos >= json.size() || json[pos] == '}') return "";
            if (json[pos] != '"') return "";
            size_t keyEnd = endOfString(json, pos);
            std::string name;
            if (!unescape(json.substr(pos, keyEnd - pos), &name)) return "";
            pos = skipWs(json, keyEnd);
            if (pos >= json.size() || json[pos] != ':') return "";
            pos = skipWs(json, pos + 1);
            size_t valueEnd = endOfValue(json, pos);
            if (name == key) return json.substr(pos, valueEnd - pos);
            pos = skipWs(json, valueEnd);
            if (pos < json.size() && json[pos] == ',') {
                pos++;
                continue;
            }
            return "";
        }
    }

    /** Unescape a JSON string literal (must include surrounding quotes). */
    static bool unescape(const std::string& raw, std::string* out) {
        if (raw.size() < 2 || raw.front() != '"' || raw.back() != '"') return false;
        out->clear();
        out->reserve(raw.size());
        size_t i = 1;
        while (i + 1 < raw.size()) {
            char c = raw[i];
            if (c != '\\') {
                out->push_back(c);
                i++;
                continue;
            }
            char esc = raw[i + 1];
            i += 2;
            switch (esc) {
                case '"': out->push_back('"'); break;
                case '\\': out->push_back('\\'); break;
                case '/': out->push_back('/'); break;
                case 'b': out->push_back('\b'); break;
                case 'f': out->push_back('\f'); break;
                case 'n': out->push_back('\n'); break;
                case 'r': out->push_back('\r'); break;
                case 't': out->push_back('\t'); break;
                case 'u': {
                    if (i + 4 > raw.size()) return false;
                    uint32_t code = 0;
                    for (int k = 0; k < 4; k++) {
                        char h = raw[i + k];
                        code <<= 4;
                        if (h >= '0' && h <= '9') code |= static_cast<uint32_t>(h - '0');
                        else if (h >= 'a' && h <= 'f') code |= static_cast<uint32_t>(h - 'a' + 10);
                        else if (h >= 'A' && h <= 'F') code |= static_cast<uint32_t>(h - 'A' + 10);
                        else return false;
                    }
                    i += 4;
                    // surrogate pair
                    if (code >= 0xD800 && code <= 0xDBFF && i + 6 <= raw.size()
                        && raw[i] == '\\' && raw[i + 1] == 'u') {
                        uint32_t low = 0;
                        bool ok = true;
                        for (int k = 0; k < 4; k++) {
                            char h = raw[i + 2 + k];
                            low <<= 4;
                            if (h >= '0' && h <= '9') low |= static_cast<uint32_t>(h - '0');
                            else if (h >= 'a' && h <= 'f') low |= static_cast<uint32_t>(h - 'a' + 10);
                            else if (h >= 'A' && h <= 'F') low |= static_cast<uint32_t>(h - 'A' + 10);
                            else { ok = false; break; }
                        }
                        if (ok && low >= 0xDC00 && low <= 0xDFFF) {
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            i += 6;
                        }
                    }
                    appendUtf8(code, out);
                    break;
                }
                default: return false;
            }
        }
        return true;
    }

    /** Escape UTF-8 text into a JSON string literal (including surrounding quotes). */
    static std::string escape(const std::string& text) {
        std::string out;
        out.reserve(text.size() + 2);
        out.push_back('"');
        for (unsigned char c : text) {
            switch (c) {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\b': out += "\\b"; break;
                case '\f': out += "\\f"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (c < 0x20) {
                        const char* hex = "0123456789abcdef";
                        out += "\\u00";
                        out.push_back(hex[(c >> 4) & 0xF]);
                        out.push_back(hex[c & 0xF]);
                    } else {
                        out.push_back(static_cast<char>(c));
                    }
            }
        }
        out.push_back('"');
        return out;
    }

private:
    static size_t endOfString(const std::string& s, size_t pos) {
        pos++; // opening quote
        while (pos < s.size()) {
            if (s[pos] == '\\') {
                pos += 2;
                continue;
            }
            if (s[pos] == '"') return pos + 1;
            pos++;
        }
        return pos;
    }

    static void appendUtf8(uint32_t code, std::string* out) {
        if (code < 0x80) {
            out->push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out->push_back(static_cast<char>(0xC0 | (code >> 6)));
            out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else if (code < 0x10000) {
            out->push_back(static_cast<char>(0xE0 | (code >> 12)));
            out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            out->push_back(static_cast<char>(0xF0 | (code >> 18)));
            out->push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
            out->push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out->push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }
};

} // namespace xpanda

#endif // XPANDA_GADGET_MINI_JSON_H
