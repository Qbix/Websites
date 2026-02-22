<?php

/**
 * @module Websites
 */

/**
 * NewsAPI adapter.
 *
 * Normalizes NewsAPI responses into provider-agnostic article items.
 *
 * @class Websites_News_Newsapi
 */
class Websites_News_Newsapi extends Websites_News implements Websites_News_Interface
{
	protected $apiKey;
	protected $endpoint = 'https://newsapi.org/v2';

	public function __construct($options = array())
	{
		$this->apiKey = Q_Config::expect('Websites', 'newsapi', 'key');
	}

	public function fetchNews(array $options = array())
	{
		// Normalize options
		$opts = Q::take($options, array(
			'type'     => 'top',
			'country'  => 'us',
			'language' => 'en',
			'keyword'  => null,
			'max'      => 12,
			'from'     => null,
			'to'       => null,
			'sources'  => null,
			'category' => null
		));

		$params = array(
			'apiKey'   => $this->apiKey,
			'pageSize' => min(100, max(1, (int) $opts['max']))
		);

		if ($opts['type'] === 'search') {
			if (!$opts['keyword']) {
				throw new Q_Exception_RequiredField(array(
					'field' => 'options.keyword'
				));
			}
			$url = $this->endpoint . '/everything';
			$params['q'] = $opts['keyword'];
			$params['language'] = $opts['language'];
			if ($opts['from']) $params['from'] = $opts['from'];
			if ($opts['to'])   $params['to']   = $opts['to'];
			if ($opts['sources']) $params['sources'] = $opts['sources'];
		} else {
			$url = $this->endpoint . '/top-headlines';
			$params['country'] = $opts['country'];
			if ($opts['category']) {
				$params['category'] = $opts['category'];
			}
		}

		// FIX: Q_Utils::get does not take params — append query string
		$url = $url . '?' . http_build_query($params);

		$response = Q_Utils::get($url, null, array(), null, 30);
		echo $response;exit;
		$data = Q::json_decode($response, true);

		if (!is_array($data)) {
			throw new Exception("Invalid NewsAPI response");
		}
		if (!empty($data['status']) && $data['status'] !== 'ok') {
			throw new Exception("NewsAPI error: " . Q::json_encode($data));
		}

		$items = array();
		foreach ((array) Q::ifset($data, 'articles', array()) as $a) {
			$items[] = $this->normalize($a, $opts['language'], $opts['country']);
		}

		return $items;
	}

	protected function normalize(array $a, $language, $country)
	{
		$item = Q::take($a, array(
			'url'         => null,
			'title'       => null,
			'description' => null,
			'content'     => null,
			'urlToImage'  => null,
			'publishedAt' => null
		), $dest = array(), array(
			'description' => 'summary',
			'urlToImage'  => 'image'
		));

		$item['id'] = $item['url'];

		$item['source'] = Q::take(Q::ifset($a, 'source', array()), array(
			'name' => null,
			'url'  => null
		));

		$item['language'] = $language;
		$item['country']  = $country;
		$item['keywords'] = array();

		return $item;
	}
}