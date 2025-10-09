export const PASSWORD_STRENGTH_LABEL_BY_SCORE: Record<number, string> = {
    0: 'weak',
    1: 'weak',
    2: 'fair',
    3: 'good',
    4: 'strong',
};

export const REGEX = {
    EMAIL: /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    NUMBER_DECIMAL: /^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?|0(?:\.\d{1,2})?)$/,
    NUMBER_INTEGER: /^(?:\d*[1-9]\d*|)$/,
    TEXT_ONLY: /^[a-zA-Z ]*$/,
    ALPHA_NUMBERICS: /^[a-zA-Z0-9-_ ]*$/,
    PASSWORD: /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+{};:,<.>])(?!.*\s).{8,}$/,
    JSON: /^[\],:{}\s]*$|^"(.|\\[\\"/bfnrt])*"$/,
};

export const MEGABYTE_CONVERTER = 1000000;

export const FIELD_TYPE = {
    TEXT: 'text',
    ALPHA_NUMBERICS: 'alphanumerics',
    RADIO: 'radio',
    EMAIL: 'email',
    SWITCH: 'switch',
    SELECT: 'select',
    REGEX: 'regex',
    PASSWORD: 'password',
    CHECKBOX: 'checkbox',
    TEXTAREA: 'textarea',
    NUMBER_ONLY: 'number_only',
    INTEGER_ONLY: 'integer_only',
    MULTI_SELECT: 'multi-select',
    AUTOCOMPLETE: 'autocomplete',
    CHECKBOX_GROUP: 'checkbox_group',
};
