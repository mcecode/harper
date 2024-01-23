use serde::{Deserialize, Serialize};

/// A window in a [char].
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }

    pub fn len(&self) -> usize {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn overlaps_with(&self, other: Self) -> bool {
        self.start.max(other.start) <= self.end.min(other.end)
    }

    pub fn get_content<'a>(&self, source: &'a [char]) -> &'a [char] {
        if cfg!(debug_assertions) {
            assert!(self.start < self.end);
            assert!(self.start < source.len());
            assert!(self.end <= source.len());
        }

        &source[self.start..self.end]
    }

    pub fn get_content_string(&self, source: &[char]) -> String {
        String::from_iter(self.get_content(source))
    }

    pub fn set_len(&mut self, length: usize) {
        self.end = self.start + length;
    }

    pub fn with_len(&self, length: usize) -> Self {
        let mut cloned = *self;
        cloned.set_len(length);
        cloned
    }

    // Add an amount to both [`Self::start`] and [`Self::end`]
    pub fn offset(&mut self, by: usize) {
        self.start += by;
        self.end += by;
    }
}

#[cfg(test)]
mod tests {
    use crate::Span;

    #[test]
    fn overlaps() {
        assert!(Span::new(0, 5).overlaps_with(Span::new(3, 6)));
        assert!(Span::new(0, 5).overlaps_with(Span::new(2, 3)));
        assert!(Span::new(0, 5).overlaps_with(Span::new(4, 5)));
        assert!(Span::new(0, 5).overlaps_with(Span::new(4, 4)));
    }
}