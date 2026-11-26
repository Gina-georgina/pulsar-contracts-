// SPDX-License-Identifier: MIT
use soroban_sdk::{Env, String, Vec};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationIssue {
    pub field: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationReport {
    pub is_valid: bool,
    pub issues: Vec<ValidationIssue>,
}

pub fn validate_payload(env: &Env, fields: &[(&str, Option<String>)]) -> ValidationReport {
    let mut issues = Vec::new(env);

    for (field_name, value) in fields.iter() {
        if let Some(value) = value {
            if value.len() == 0 {
                issues.push_back(ValidationIssue {
                    field: String::from_str(env, field_name),
                    message: String::from_str(env, "must not be empty"),
                });
            }
            if field_name == &"amount" && value.len() > 0 {
                let parsed: i128 = value.to_string().parse().unwrap_or(0);
                if parsed <= 0 {
                    issues.push_back(ValidationIssue {
                        field: String::from_str(env, field_name),
                        message: String::from_str(env, "must be positive"),
                    });
                }
            }
        } else {
            issues.push_back(ValidationIssue {
                field: String::from_str(env, field_name),
                message: String::from_str(env, "is required"),
            });
        }
    }

    ValidationReport { is_valid: issues.is_empty(), issues }
}

pub fn validate_string_length(env: &Env, value: &String, field_name: &str, max_len: u32) -> Result<(), ValidationIssue> {
    if value.len() > max_len {
        Err(ValidationIssue {
            field: String::from_str(env, field_name),
            message: String::from_str(env, "exceeds the maximum allowed length"),
        })
    } else {
        Ok(())
    }
}

/// Sanitise an arbitrary byte slice into a valid `String` for the given env.
///
/// This is the single entry point used by the fuzz target (and any other
/// caller that needs to turn untrusted bytes into a contract `String`). It
/// never panics: invalid UTF-8 is replaced lossily and the result is truncated
/// to `max_len` bytes on a UTF-8 boundary so that downstream validation can
/// never observe a malformed or oversized value.
pub fn sanitize_bytes(env: &Env, bytes: &[u8], max_len: u32) -> String {
    let max_len = max_len as usize;
    let truncated = if bytes.len() > max_len { &bytes[..max_len] } else { bytes };

    // Trim any trailing bytes that would split a multi-byte UTF-8 sequence.
    let mut end = truncated.len();
    while end > 0 && std::str::from_utf8(&truncated[..end]).is_err() {
        end -= 1;
    }
    let valid = &truncated[..end];

    match std::str::from_utf8(valid) {
        Ok(s) => String::from_str(env, s),
        Err(_) => String::from_str(env, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_required_fields_and_positive_amounts() {
        let env = Env::default();
        let merchant_id = String::from_str(&env, "merchant-1");
        let amount = String::from_str(&env, "100");
        let report = validate_payload(&env, &[("merchant_id", Some(merchant_id.clone())), ("amount", Some(amount.clone())), ("reason", None)]);

        assert!(!report.is_valid);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues.get(0).unwrap().field, String::from_str(&env, "reason"));
    }

    #[test]
    fn rejects_non_positive_amounts() {
        let env = Env::default();
        let report = validate_payload(&env, &[("amount", Some(String::from_str(&env, "0")))]);

        assert!(!report.is_valid);
        assert_eq!(report.issues.len(), 1);
    }

    #[test]
    fn sanitize_bytes_handles_arbitrary_input() {
        let env = Env::default();

        // Invalid UTF-8 must not panic.
        let _ = sanitize_bytes(&env, &[0xff, 0xfe, 0xfd], 16);
        // Truncation must respect UTF-8 boundaries.
        let s = sanitize_bytes(&env, "héllo".as_bytes(), 2);
        assert!(s.len() <= 2);
        // Empty input yields an empty string.
        assert_eq!(sanitize_bytes(&env, &[], 8).len(), 0);
    }

    #[test]
    fn validate_payload_never_panics_on_sanitized_input() {
        let env = Env::default();
        let merchant = sanitize_bytes(&env, b"merchant\xff", 64);
        let description = sanitize_bytes(&env, b"desc", 64);
        let contact = sanitize_bytes(&env, b"contact@example.com", 64);
        let amount = sanitize_bytes(&env, b"not-a-number", 32);

        let report = validate_payload(
            &env,
            &[
                ("merchant_name", Some(merchant)),
                ("description", Some(description)),
                ("contact_info", Some(contact)),
                ("amount", Some(amount)),
            ],
        );
        // Non-numeric amount parses to 0 and is rejected, but no panic occurs.
        assert!(!report.is_valid);
    }
}
