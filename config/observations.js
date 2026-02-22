{
	"Streams/webpage": {
		"metadataNormalization": {
			"promptClause": "Normalize and clean webpage metadata using only fields explicitly provided by the page (title, description, og:title, og:description, keywords, headers). Do not invent content. Prefer og:* fields when present. If fields conflict, pick the most semantically descriptive one. If missing, return null. Do not summarize page body text.",
			"fieldNames": [
				"title",
				"description",
				"keywords",
				"canonicalUrl",
				"siteName",
				"lang"
			],
			"example": {
				"title": "OpenAI",
				"description": "Artificial intelligence research and deployment company.",
				"keywords": ["ai", "research", "openai"],
				"canonicalUrl": "https://openai.com/",
				"siteName": "OpenAI",
				"lang": "en"
			}
		},
		"contentClassification": {
			"promptClause": "Classify the webpage using only metadata (title, description, og:type, og:site_name, headers). Do not infer page body content. Determine content type, topic category, and intent.",
			"fieldNames": [
				"contentType",
				"topic",
				"intent"
			],
			"example": {
				"contentType": "article",
				"topic": ["technology", "ai"],
				"intent": "informational"
			}
		},

		"discoveryQuality": {
			"promptClause": "Derive up to 10 lowercase alphanumeric English keywords suitable for search discovery using only metadata fields. If metadata is non-English, also derive keywordsNative from visible metadata text. Do not invent terms not present in metadata.",
			"fieldNames": [
				"shareability",
				"keywords",
				"keywordsNative"
			],
			"example": {
				"keywords": ["ai", "research", "openai"],
				"keywordsNative": [],
				"shareability": 7
			}
		},

		"safety": {
			"promptClause": "Assess safety risk based only on visible metadata (title, description, og tags). Do not scan page body. Rate obscenity and controversy visibility, not intent.",
			"fieldNames": [
				"obscene",
				"controversial"
			],
			"example": {
				"obscene": 1,
				"controversial": 2
			}
		}
	}