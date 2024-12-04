<?php

function Websites_before_Streams_Stream_save_Websites_article($params)
{
	$stream = $params['stream'];
	$modifiedFields = $params['modifiedFields'];

	if (!empty($modifiedFields['article'])) {
		// sanitize the whole article
		$tree = Q_Tree::createAndLoad(Q_CONFIG_DIR.DS.'sanitize'.DS.'html.json');
		$whitelist = $tree->expect('sanitize', 'whitelist');
		$article = Q_Html::sanitize($stream->article, $whitelist);
		$stream->article = $article;
		// Now summarize just the text, in the article
		// TODO: have option to AI to make a summary, when available
		$whitelist = array('#text' => true);
		$content = Q_Html::sanitize($article, $whitelist);
		$content = trim(preg_replace('/\s\s+/', ' ', str_replace(
			array('&nbsp;', "\n"),
			array(' ', ' '),
			$content
		)));
		$a = new Streams_Stream();
		$stream->content = substr($content, 0, $a->maxSize_content() - 100);
	}

	if ($stream->wasRetrieved()) {
		return;
	}

	$user = new Users_User();
	if (empty($stream->userId) and empty($modifiedFields['userId'])) {
		if ($liu = Users::loggedInUser()) {
			$stream->userId = $liu->id;
		} else {
			throw new Q_Exception_RequiredField(array('field' => 'userId'));
		}
	}
	$user->id = $stream->userId;
	if (!$user->retrieve()) {
		throw new Users_Exception_NoSuchUser();
	}

	$title = Streams::displayName($user, array('fullAccess' => true));
	if (isset($title) && empty($stream->title)) {
		$stream->title = $title;
	}

	if (!$stream->isCustomIcon()) {
		$stream->icon = $user->iconUrl(false);
	}

	$s = Streams_Stream::fetch($user->id, $user->id, "Streams/user/icon");
	if (!$s or !$sizes = $s->getAttribute('sizes', null)) {
		$sizes = Q_Image::getSizes('Users/icon');
	}
	$stream->setAttribute('sizes', $sizes);
}