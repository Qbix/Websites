<?php

// ═══════════════════════════════════════════════════════════════════
// Websites plugin — articles, pages, permalinks
// File: plugins/Websites/handlers/Q/SafeScript/scope.php
// ═══════════════════════════════════════════════════════════════════

function Websites_before_Q_SafeScript_scope($params)
{
	$scope = &$params['scope'];

	// Fetch a webpage stream with its SEO fields
	$scope['Websites_getWebpage'] = function ($publisherId, $name) {
		$loggedIn = Users::loggedInUserId();
		$stream = Streams::fetchOne($loggedIn, $publisherId, $name);
		if (!$stream) return null;
		return array(
			'publisherId' => $stream->publisherId,
			'name' => $stream->name,
			'title' => $stream->title,
			'content' => $stream->content,
			'icon' => $stream->icon,
			'attributes' => $stream->getAllAttributes(),
			'url' => $stream->getAttribute('url'),
			'description' => $stream->getAttribute('description')
		);
	};

	// Get permalink
	$scope['Websites_permalink'] = function ($uri) {
		$permalink = Websites_Permalink::select()
			->where(array('uri' => $uri))
			->fetchDbRow();
		return $permalink ? $permalink->url : null;
	};
}