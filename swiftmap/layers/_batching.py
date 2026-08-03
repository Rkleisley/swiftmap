import functools


def batched(fn):
    """
    Collapses one public map mutation into a single sync message.

    An add_* call can touch the map many times -- a column-driven `layer_group` creates one
    layer per folder, each with its own coordinate buffer -- and without this every one of
    those would be sent separately. Map.batch() is reentrant, so this composes with callers
    that already wrap their own call sites.
    """
    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        with self.batch():
            return fn(self, *args, **kwargs)
    return wrapper
