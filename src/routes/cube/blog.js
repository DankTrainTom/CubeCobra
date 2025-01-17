const express = require('express');

const { ensureAuth } = require('../middleware');
const util = require('../../util/util');
const { render, redirect } = require('../../util/render');
const generateMeta = require('../../util/meta');

const { abbreviate, isCubeViewable } = require('../../util/cubefn');

const Cube = require('../../dynamo/models/cube');
const Blog = require('../../dynamo/models/blog');
const User = require('../../dynamo/models/user');
const Feed = require('../../dynamo/models/feed');

const router = express.Router();

router.post('/post/:id', ensureAuth, async (req, res) => {
  try {
    if (req.body.title.length < 5 || req.body.title.length > 100) {
      req.flash('danger', 'Blog title length must be between 5 and 100 characters.');
      return redirect(req, res, `/cube/blog/${encodeURIComponent(req.params.id)}`);
    }

    const { user } = req;
    
    if (req.body.id && req.body.id.length > 0) {
      // update an existing blog post
      const blog = await Blog.getUnhydrated(req.body.id);

      if (blog.owner !== user.id) {
        req.flash('danger', 'Unable to update this blog post: Unauthorized.');
        return redirect(req, res, `/cube/blog/${encodeURIComponent(req.params.id)}`);
      }

      blog.body = req.body.markdown.substring(0, 10000);
      blog.title = req.body.title;

      await Blog.put(blog);

      req.flash('success', 'Blog update successful');
      return redirect(req, res, `/cube/blog/${encodeURIComponent(req.params.id)}`);
    }

    const cube = await Cube.getById(req.params.id);

    if (!isCubeViewable(cube, user)) {
      req.flash('danger', 'Cube not found');
      return redirect(req, res, '/cube/blog/404');
    }

    // if this cube has no cards, we deny them from making any changes
    // this is a spam prevention measure
    if (cube.cardCount === 0) {
      req.flash('danger', 'Cannot post a blog for an empty cube. Please add cards to the cube first.');
      return redirect(req, res, '/cube/blog/' + cube.id);
    }

    // post new blog
    if (cube.owner.id !== user.id) {
      req.flash('danger', 'Unable to post this blog post: Unauthorized.');
      return redirect(req, res, `/cube/blog/${encodeURIComponent(req.params.id)}`);
    }

    const id = await Blog.put({
      body: req.body.markdown.substring(0, 10000),
      owner: user.id,
      date: new Date().valueOf(),
      cube: cube.id,
      title: req.body.title,
    });

    const followers = [...new Set([...(req.user.following || []), ...cube.following, ...(req.body.mentions || [])])];

    const feedItems = followers.map((userId) => ({
      id,
      to: userId,
      date: new Date().valueOf(),
      type: Feed.TYPES.BLOG,
    }));

    await Feed.batchPut(feedItems);

    // mentions are only added for new posts and ignored on edits
    if (req.body.mentions) {
      for (const mention of req.body.mentions) {
        const mentioned = await User.getByUsername(mention);

        if (mentioned) {
          await util.addNotification(
            mentioned,
            user,
            `/cube/blog/blogpost/${id}`,
            `${user.username} mentioned you in their blog post`,
          );
        }
      }
    }

    req.flash('success', 'Blog post successful');
    return redirect(req, res, `/cube/blog/${encodeURIComponent(req.params.id)}`);
  } catch (err) {
    return util.handleRouteError(req, res, err, `/cube/blog/${encodeURIComponent(req.params.id)}`);
  }
});

router.get('/blogpost/:id', async (req, res) => {
  try {
    const post = await Blog.getById(req.params.id);

    if (!post) {
      req.flash('danger', 'Blog post not found');
      return redirect(req, res, '/404');
    }

    if (post.cube !== 'DEVBLOG') {
      const cube = await Cube.getById(post.cube);

      if (!isCubeViewable(cube, req.user)) {
        req.flash('danger', 'Blog post not found');
        return redirect(req, res, '/404');
      }
    }

    return render(req, res, 'BlogPostPage', {
      post,
    });
  } catch (err) {
    return util.handleRouteError(req, res, err, '/404');
  }
});

router.get('/remove/:id', ensureAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.getById(id);

    if (blog.owner.id !== req.user.id) {
      req.flash('danger', 'Unauthorized');
      return redirect(req, res, '/404');
    }

    await Blog.delete(id);

    req.flash('success', 'Post Removed');
    return redirect(req, res, `/cube/blog/${encodeURIComponent(blog.cube)}`);
  } catch {
    req.flash('danger', 'Error deleting post.');
    return redirect(req, res, '/404');
  }
});

router.post('/getmoreblogsbycube/:id', async (req, res) => {
  const { lastKey } = req.body;
  const posts = await Blog.getByCube(req.params.id, 20, lastKey);

  return res.status(200).send({
    success: 'true',
    items: posts.items,
    lastKey: posts.lastKey,
  });
});

router.get('/:id', async (req, res) => {
  try {
    const cube = await Cube.getById(req.params.id);

    if (!isCubeViewable(cube, req.user)) {
      req.flash('danger', 'Cube not found');
      return redirect(req, res, '/404');
    }

    const query = await Blog.getByCube(cube.id, 20);

    return render(
      req,
      res,
      'CubeBlogPage',
      {
        cube,
        posts: query.items,
        lastKey: query.lastKey,
      },
      {
        title: `${abbreviate(cube.name)} - Blog`,
        metadata: generateMeta(
          `Cube Cobra Blog: ${cube.name}`,
          cube.description,
          cube.image.uri,
          `https://cubecobra.com/cube/blog/${encodeURIComponent(req.params.id)}`,
        ),
      },
    );
  } catch (err) {
    return util.handleRouteError(req, res, err, `/cube/overview/${encodeURIComponent(req.params.id)}`);
  }
});

module.exports = router;
