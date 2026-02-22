<?php

/**
 * @module Websites
 */

/**
 * EventRegistry (newsapi.ai) adapter.
 *
 * Normalizes EventRegistry responses into provider-agnostic article items.
 *
 * @class Websites_News_Eventregistry
 */
class Websites_News_Eventregistry extends Websites_News implements Websites_News_Interface
{
	protected $apiKey;
	protected $endpoint = 'https://eventregistry.org/api/v1/article/getArticles';

	public function __construct($options = array())
	{
		$this->apiKey = Q_Config::expect('Websites', 'eventregistry', 'key');
	}

	public function fetchNews(array $options = array())
	{
		$opts = Q::take($options, array(
			'type'     => 'top',
			'country'  => 'us',
			'language' => 'en',
			'keyword'  => null,
			'max'      => 5,
			'page'     => 1
		));

		$body = array(
			'action'                 => 'getArticles',
			'resultType'             => 'articles',
			'articlesPage'           => (int) $opts['page'],
			'articlesCount'          => min(100, max(1, (int) $opts['max'])),
			'articlesSortBy'         => 'date',
			'articlesSortByAsc'      => false,
			'dataType'               => array('news'),
			'forceMaxDataTimeWindow' => 1,
			'apiKey'                 => $this->apiKey
		);

		if ($opts['keyword']) {
			$body['keyword'] = $opts['keyword'];
		}

		if ($opts['language']) {
			$body['lang'] = $opts['language'];
		}

		if ($opts['country']) {
			$body['sourceLocationUri'] = array(
				'http://en.wikipedia.org/wiki/' . $this->_countryWiki($opts['country'])
			);
		}

		$headers = array(
			'Content-Type: application/json'
		);

		$response = Q_Utils::post(
			$this->endpoint,
			json_encode($body),
			null,
			array(),     // curl opts
			$headers,
			30
		);

		$data = Q::json_decode($response, true);

		if (!is_array($data) || empty($data['articles']['results'])) {
			Q::log('EventRegistry error or empty result: ' . $response);
			return array();
		}

		$items = array();
		foreach ($data['articles']['results'] as $a) {
			$items[] = $this->normalize($a, $opts['language'], $opts['country']);
		}

		return $items;
	}

	protected function normalize(array $a, $language, $country)
	{
		$item = Q::take($a, array(
			'uri'         => null,
			'url'         => null,
			'title'       => null,
			'body'        => null,
			'image'       => null,
			'dateTimePub' => null
		), $dest = array(), array(
			'body'        => 'summary',
			'image'       => 'image',
			'dateTimePub' => 'publishedAt'
		));

		$item['id'] = $item['uri'];
		unset($item['uri']);

		$item['source'] = Q::take(Q::ifset($a, 'source', array()), array(
			'title' => null,
			'uri'   => null
		), $src = array(), array(
			'title' => 'name',
			'uri'   => 'url'
		));

		$item['language'] = $language;
		$item['country']  = $country;
		$item['keywords'] = array();

		return $item;
	}

	protected function _countryWiki($cc)
	{
		static $map = array(
			'us' => 'United_States',
			'uk' => 'United_Kingdom',
			'ca' => 'Canada',
			'de' => 'Germany',
			'fr' => 'France',
			'it' => 'Italy',
			'es' => 'Spain',
			'ru' => 'Russia',
			'ua' => 'Ukraine',
			'il' => 'Israel'
		);

		$cc = strtolower($cc);
		return Q::ifset($map, $cc, strtoupper($cc));
	}
}