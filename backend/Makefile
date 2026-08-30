.PHONY: install test test-cov build validate local-api deploy-dev clean

ifneq (,$(wildcard .env))
    include .env
    export
endif

install:
	poetry install

test:
	poetry run pytest tests/unit -v

test-cov:
	poetry run pytest tests/unit -v --cov --cov-report=term-missing

build:
	sam build

validate:
	sam validate --lint

local-api: build
	sam local start-api \
	  --env-vars env.local.json \
	  --port 3001

deploy-dev: build
	sam deploy --config-env dev --parameter-overrides \
	  "ProjectNo=pj007" \
	  "ProjectName=digging-tournament" \
	  "Environment=dev" \
	  "BillingTag=pj007" \
	  "AllowedOrigin=$${ALLOWED_ORIGIN:-*}" \
	  "GitHubRepo=reimaruku-git/pj007-sfl-digging-tournament" \
	  "GitHubOidcClassicSubject=repo:reimaruku-git/pj007-sfl-digging-tournament:*" \
	  "GitHubOidcSubject=repo:reimaruku-git@248281558/pj007-sfl-digging-tournament@1334189130:*"

clean:
	rm -rf .aws-sam/
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
